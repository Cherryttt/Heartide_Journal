from llm_client import llm_client


def test_agent_prompt_discloses_ai_identity():
    messages = llm_client._agent_messages("加缪", "你是谁？", [])
    system_prompt = messages[0]["content"]
    assert "AI 文学陪伴角色" in system_prompt
    assert "不是真人" in system_prompt
    assert "不要声称自己就是" in system_prompt
