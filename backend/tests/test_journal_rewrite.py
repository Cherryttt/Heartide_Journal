from llm_client import _extract_json, _map_fragment_lines


def test_extract_json_plain_array():
    assert _extract_json('["甲", "乙"]') == ["甲", "乙"]


def test_extract_json_strips_markdown_fence():
    raw = "```json\n[\"晨光落在窗台\", \"我把今天收好\"]\n```"
    assert _extract_json(raw) == ["晨光落在窗台", "我把今天收好"]


def test_extract_json_pulls_array_out_of_prose():
    raw = '好的，这是润色后的句子：\n["第一句", "第二句"]\n希望你喜欢。'
    assert _extract_json(raw) == ["第一句", "第二句"]


def test_extract_json_handles_object_in_fence():
    raw = "```\n{\"word\": \"恬\"}\n```"
    assert _extract_json(raw) == {"word": "恬"}


def test_map_fragment_lines_fenced_output_is_applied_not_discarded():
    # 这是回归此前 bug 的核心断言：被 ```json 围栏包裹时，旧实现会整批退回原句。
    texts = ["今天有点累", "但黄昏很好看"]
    raw = "```json\n[\"今天有点累，像被揉皱的纸\", \"但黄昏把我轻轻展开\"]\n```"
    assert _map_fragment_lines(raw, texts) == [
        "今天有点累，像被揉皱的纸",
        "但黄昏把我轻轻展开",
    ]


def test_map_fragment_lines_falls_back_per_index_on_partial_result():
    texts = ["第一句", "第二句", "第三句"]
    raw = '["润色一"]'  # 模型只返回了一条
    assert _map_fragment_lines(raw, texts) == ["润色一", "第二句", "第三句"]


def test_map_fragment_lines_falls_back_when_unparseable():
    texts = ["原句一", "原句二"]
    assert _map_fragment_lines("[LLM 未配置] 请在 .env 中设置 ZHIPU_API_KEY", texts) == texts


def test_map_fragment_lines_skips_blank_and_non_string_items():
    texts = ["保留一", "保留二", "保留三"]
    raw = '["", 123, {"x": 1}]'
    # "" -> 原句; 123 -> "123"(数字可接受); dict -> 原句
    assert _map_fragment_lines(raw, texts) == ["保留一", "123", "保留三"]
