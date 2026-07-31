from app import dict_to_xml_str
test_data = {"session_id": "123", "speakers_count": 2, "metrics": {"duration": 1.5}, "list": [{"a": 1}, {"b": 2}]}
print(dict_to_xml_str(test_data))
