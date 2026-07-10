from database import SimpleVectorCollection


def test_vector_collection_persists_and_deletes(tmp_path):
    collection = SimpleVectorCollection("test", str(tmp_path))
    collection.add(["one"], [[1.0, 0.0]], ["hello"], [{"user_id": "u1"}])

    reloaded = SimpleVectorCollection("test", str(tmp_path))
    assert reloaded.ids == ["one"]
    assert reloaded.docs == ["hello"]

    reloaded.delete(["one"])
    final = SimpleVectorCollection("test", str(tmp_path))
    assert final.ids == []
