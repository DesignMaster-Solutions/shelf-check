import json, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import shelfcheck as sc

FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fixtures", "skin-result.json")


class Recommend(unittest.TestCase):
    def test_worst_concern_drives_the_pick(self):
        scores = {c: {"score": 95.0} for c in sc.CONCERNS}
        scores["moisture"]["score"] = 40.0
        top = sc.recommend(scores, sc.load_catalog())
        self.assertIn("Dehydration", top[0]["because"])
        self.assertTrue(all(i["fit"] >= j["fit"] for i, j in zip(top, top[1:])))

    def test_perfect_skin_recommends_nothing(self):
        self.assertEqual(sc.recommend({c: {"score": 100.0} for c in sc.CONCERNS}, sc.load_catalog()), [])

    def test_tie_goes_to_cheaper(self):
        cat = [{"sku": "a", "name": "A", "price": 9, "treats": ["acne"]},
               {"sku": "b", "name": "B", "price": 5, "treats": ["acne"]}]
        self.assertEqual(sc.recommend({"acne": {"score": 50.0}}, cat)[0]["sku"], "b")

    def test_real_api_fixture_parses(self):
        with open(FIX) as f:
            scores = sc.parse(json.load(f)["data"]["results"])
        self.assertEqual(set(scores), set(sc.CONCERNS))
        self.assertTrue(sc.recommend(scores, sc.load_catalog()))

    def test_skin_type_reweights_the_same_scores(self):
        scores = {c: {"score": 90.0} for c in sc.CONCERNS}
        scores["age_spot"]["score"] = 70.0  # need 30
        scores["redness"]["score"] = 68.0   # need 32
        cat = [{"sku": "spots", "name": "S", "price": 10, "treats": ["age_spot"]},
               {"sku": "calm", "name": "C", "price": 10, "treats": ["redness"]}]
        self.assertEqual(sc.recommend(scores, cat)[0]["sku"], "calm")  # as measured, redness is the bigger need
        self.assertEqual(sc.recommend(scores, cat, skin_type="V")[0]["sku"], "spots")  # type V: marks weigh 1.3x
        self.assertEqual(sc.recommend(scores, cat, skin_type="I")[0]["sku"], "calm")
        self.assertEqual(sc.recommend(scores, cat, skin_type="??")[0]["sku"], "calm")  # unknown type = as measured

    def test_every_fitzpatrick_type_has_weights_and_a_note(self):
        self.assertEqual(set(sc.FITZ), {"I", "II", "III", "IV", "V", "VI"})
        for weights, note in sc.FITZ.values():
            self.assertTrue(note.startswith("Type "), note)
            self.assertTrue(all(w >= 1.0 for w in weights.values()), weights)  # never hide a measured need

    def test_fitzpatrick_fixture_parses(self):
        with open(FIX.replace("skin-result", "fitzpatrick-result")) as f:
            self.assertIn(sc.parse_skin_type(json.load(f)["data"]["results"]), sc.FITZ)


if __name__ == "__main__":
    unittest.main()
