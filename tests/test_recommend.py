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


if __name__ == "__main__":
    unittest.main()
