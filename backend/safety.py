"""情绪危机信号识别与安全优先回应。"""

import re


HIGH_RISK_PATTERNS = [
    r"想死", r"不想活", r"结束生命", r"结束这一切", r"自杀", r"伤害自己",
    r"活不下去", r"没有活着的意义", r"永远消失", r"从楼上跳", r"割腕",
]
ELEVATED_RISK_PATTERNS = [
    r"只想消失", r"撑不下去", r"没有希望", r"没人会在乎", r"不如死了",
    r"一切都没意义", r"彻底离开", r"再也不想醒",
]
NEGATED_PATTERNS = [
    r"不想自杀", r"不会自杀", r"没有自杀", r"不想死", r"不会伤害自己",
]


def detect_crisis(text: str) -> dict:
    normalized = re.sub(r"\s+", "", text or "")
    if not normalized:
        return {"risk_level": "none", "safety_message": None}
    if any(re.search(pattern, normalized) for pattern in NEGATED_PATTERNS):
        return {"risk_level": "none", "safety_message": None}
    if any(re.search(pattern, normalized) for pattern in HIGH_RISK_PATTERNS):
        return {"risk_level": "high", "safety_message": crisis_response("high")}
    if any(re.search(pattern, normalized) for pattern in ELEVATED_RISK_PATTERNS):
        return {"risk_level": "elevated", "safety_message": crisis_response("elevated")}
    return {"risk_level": "none", "safety_message": None}


def crisis_response(level: str) -> str:
    if level == "high":
        return (
            "我很在意你刚才说的话。现在先不要独自承担，也请暂时远离可能伤害自己的物品或地点。"
            "如果你正处于立即危险中，请在中国拨打 120 或 110；其他地区请联系当地紧急服务。"
            "也请立刻联系一位你信任的人，让 TA 来到你身边。你可以只回复我：你现在安全吗？"
        )
    return (
        "听起来你已经撑得很辛苦了。先别一个人扛着，可以现在联系一位信任的人，告诉 TA 你需要陪伴。"
        "如果出现伤害自己的念头或无法保证安全，请立即联系当地紧急服务。你现在身边有人吗？"
    )
