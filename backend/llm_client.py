"""
智谱 AI LLM 客户端抽象层
支持 GLM-4.6V (视觉) 和 GLM-4.5-Flash (快速文本)
"""
import json
import re
import httpx
from config import settings


def _extract_json(raw: str):
    """从可能被 ```json 代码块或额外说明文字包裹的 LLM 输出中解析出 JSON。

    GLM-4.5-Flash 经常把 JSON 数组/对象包在 markdown 代码块里，或在前后多写一句话，
    直接 json.loads 会抛 JSONDecodeError。这里先剥掉代码块围栏，再退回到
    “抓取第一段 [...] 或 {...}” 的方式。解析不出时抛 JSONDecodeError 由调用方兜底。
    """
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z0-9]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    match = re.search(r"(\[.*\]|\{.*\})", text, re.S)
    if match:
        return json.loads(match.group(1))  # 仍可能抛 JSONDecodeError，交给调用方
    raise json.JSONDecodeError("no json found", text, 0)


def _map_fragment_lines(raw: str, texts: list[str]) -> list[str]:
    """把逐句润色的模型输出解析成“每条输入对应一条输出”。

    任何一步失败都按下标回退到用户原句，而不是整批丢弃——这样即使模型只润色了
    一部分、或个别条目不是字符串，其余润色结果依然能保留。
    """
    try:
        parsed = _extract_json(raw)
    except (json.JSONDecodeError, ValueError):
        return list(texts)
    if not isinstance(parsed, list):
        return list(texts)
    lines: list[str] = []
    for index, original in enumerate(texts):
        candidate = parsed[index] if index < len(parsed) else None
        if isinstance(candidate, (str, int, float)) and str(candidate).strip():
            lines.append(str(candidate).strip())
        else:
            lines.append(original)
    return lines


class LLMClient:
    """智谱 API 统一客户端"""

    def __init__(self):
        self.api_key = settings.zhipu_api_key
        self.base_url = "https://open.bigmodel.cn/api/paas/v4"
        self.vision_model = settings.glm_vision_model
        self.flash_model = settings.glm_flash_model

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    async def _chat(
        self,
        model: str,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ) -> str:
        """通用对话请求"""
        if not self.api_key:
            return "[LLM 未配置] 请在 .env 中设置 ZHIPU_API_KEY"

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{self.base_url}/chat/completions",
                headers=self._headers(),
                json={
                    "model": model,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                },
            )
            data = resp.json()
            return data["choices"][0]["message"]["content"]

    async def _stream_chat(self, model: str, messages: list[dict], temperature: float = 0.7, max_tokens: int = 2048):
        if not self.api_key:
            yield "[LLM 未配置] 请在 .env 中设置 ZHIPU_API_KEY"
            return
        async with httpx.AsyncClient(timeout=90) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/chat/completions",
                headers=self._headers(),
                json={"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens, "stream": True},
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if payload == "[DONE]":
                        break
                    try:
                        chunk = json.loads(payload)["choices"][0]["delta"].get("content", "")
                        if chunk:
                            yield chunk
                    except (json.JSONDecodeError, KeyError, IndexError, TypeError):
                        continue

    def _agent_messages(self, persona_key: str, message: str, history: list[dict], context: str = "") -> list[dict]:
        persona_prompts = {
            "加缪": "你是阿尔贝·加缪，法国哲学家、作家。你谈论荒诞、反抗、自由。语气冷静、理性，偶尔带点西西弗式的幽默。",
            "村上春树": "你是村上春树，日本作家。语气疏离但温柔，常用日常生活意象。",
            "史铁生": "你是史铁生，中国作家。语气温和而深刻，从生命困境中提炼意义。",
            "王小波": "你是王小波，中国作家。语气幽默、理性、自由而有趣。",
            "温柔朋友": "你是一个温柔、不评判的朋友。你倾听、理解、陪伴，不急于给建议。",
            "海边小鹿": "你是一只生活在海边的治愈小鹿，话不多，用简单动作和温暖话语陪伴。",
            "睡前故事人": "你是一个用很轻的声音讲睡前故事的人，帮助对方放松。",
        }
        role_prompt = persona_prompts.get(persona_key) or f"你是一个受作家{persona_key}作品气质启发的文学陪伴角色，以其思想主题与文风自然回应。"
        system_prompt = (
            "你是由「心潮手帐」提供的 AI 文学陪伴角色，不是真人，也不提供医疗诊断。"
            "不要声称自己就是某位真实作者；如果用户询问身份，请如实说明。"
            "遇到自伤、自杀或立即危险信号时，停止角色扮演，优先鼓励用户联系现实中的可信任者和当地紧急服务。\n\n"
            + role_prompt
        )
        if context:
            system_prompt += f"\n\n可参考的知识库内容：\n{context}"
        messages = [{"role": "system", "content": system_prompt}]
        messages.extend({"role": "assistant" if item["role"] == "agent" else "user", "content": item["text"]} for item in history[-10:])
        messages.append({"role": "user", "content": message})
        return messages

    async def agent_chat_stream(self, persona_key: str, message: str, history: list[dict], context: str = ""):
        async for chunk in self._stream_chat(self.flash_model, self._agent_messages(persona_key, message, history, context), temperature=0.7, max_tokens=1024):
            yield chunk

    # ============================================================
    # 高层 API
    # ============================================================

    async def analyze_emotion(self, text: str) -> dict:
        """用 Flash 模型做情绪分析兜底"""
        prompt = f"""分析以下文本的情绪，返回 JSON 格式：
{{
  "emotions": [{{"mood": "心情词", "probability": 0.0~1.0, "color": "#hex"}}],
  "valence": 0.0~1.0,
  "arousal": 0.0~1.0,
  "tags": ["标签1", "标签2"],
  "colors": ["#hex1", "#hex2"],
  "imagery": ["意象1", "意象2"]
}}

心情词从以下选：开心、期待、激动、治愈、平静、放松、忧郁、焦虑、疲惫、孤独、空白、安静

文本：{text}"""
        result = await self._chat(
            self.flash_model,
            [{"role": "user", "content": prompt}],
            temperature=0.3,
        )
        try:
            return _extract_json(result)
        except json.JSONDecodeError:
            return {"emotions": [], "valence": 0.5, "arousal": 0.5, "tags": [], "colors": [], "imagery": []}

    async def generate_poem(self, text: str, style: str) -> str:
        """用 Flash 模型生成拼贴诗(Vision 模型对纯文本会返回空)"""
        prompt = f"""你是“心潮手帐”的诗贴纸生成器。请把下面这些日记碎片整理成一张“完整诗贴纸”。
风格：{style}

内容素材：
{text}

要求：
- 输出 4-6 行，每行 8-16 个汉字，整体不要超过 90 个汉字
- 从所有素材里提炼一个共同意象，让整首诗读起来连贯
- 保留用户原本的情绪走向，不要强行治愈或变开心
- 如果风格是“保留原声”，以用户自己的语气为主；否则只把作者风格当作轻微滤镜
- 不要解释，不要标题，不要编号，直接输出诗贴纸正文"""
        return await self._chat(
            self.flash_model,
            [{"role": "user", "content": prompt}],
            temperature=0.9,
            max_tokens=1500,
        )

    async def rewrite_fragments(self, texts: list[str], style: str) -> list[str]:
        """Rewrite every record into one collage-ready poetic sticker."""
        style_guides = {
            "\u4fdd\u7559\u539f\u58f0": "Keep the user's own voice. Only tighten rhythm and imagery; do not imitate an author.",
            "\u6751\u4e0a\u6625\u6811": "Murakami-inspired, but subtle: plain daily objects, quiet distance, tender loneliness, light surreal drift. Never use canned motifs such as jazz, whiskey, cats, wells, moons, or 'like a jazz tune at night' unless the original text explicitly mentions them. Do not start every line with 'like/as if'.",
            "\u6d77\u5b50": "Haizi-inspired: clean fields, sun, wheat, river, distance, body warmth; avoid slogans and excessive grandeur.",
            "\u8042\u9c81\u8fbe": "Neruda-inspired: tactile, sensuous, oceanic and warm; keep it intimate, not ornate.",
            "\u6cf0\u6208\u5c14": "Tagore-inspired: light, birds, prayer-like calm, human tenderness; avoid preachy aphorisms.",
        }
        style_guide = style_guides.get(style, "Use the named style only as a faint literary filter. Keep the user's facts and mood.")
        prompt = f"""You are the fragment-polishing engine for Heartide Journal.
Rewrite each diary input into ONE short poetic sticker in Simplified Chinese.

Style name: {style}
Style guide: {style_guide}

Hard rules:
- Number of outputs must equal number of inputs, same order.
- Return ONLY a JSON string array. No markdown, no explanation, no numbering.
- Preserve each input's facts, emotion, perspective, and concrete details.
- Do NOT merely add a prefix or suffix to the original sentence; rewrite the sentence structure and image.
- Do NOT use template openings like "\u50cf..." repeatedly.
- Each output should be 10-24 Chinese characters. One line only.
- Keep collage pleasure: each sticker can stand alone, but the set should feel related.
- Avoid over-healing, moral lessons, motivational slogans, and fake optimism.
- If the style is Murakami-inspired, especially avoid the words "\u7235\u58eb", "\u5a01\u58eb\u5fcc", "\u732b", "\u4e95", "\u6708\u4eae" unless they appear in the input.

Inputs JSON:
{json.dumps(texts, ensure_ascii=False)}"""
        result = await self._chat(self.flash_model, [{"role": "user", "content": prompt}], temperature=0.82, max_tokens=1200)
        lines = _map_fragment_lines(result, texts)
        if style == "\u6751\u4e0a\u6625\u6811":
            bad_tokens = ("\u7235\u58eb", "\u50cf\u591c\u91cc", "\u5a01\u58eb\u5fcc")
            has_template = any(any(token in line for token in bad_tokens) for line in lines)
            has_prefix_only = any(len(original.strip()) >= 6 and original.strip() in line and len(line) > len(original.strip()) + 2 for line, original in zip(lines, texts))
            if has_template or has_prefix_only:
                retry_prompt = prompt + "\n\nRetry because the previous result was too templated. Do not use jazz/night-prefix cliches. Do not include the original sentence as a suffix. Return only a JSON string array."
                retry = await self._chat(self.flash_model, [{"role": "user", "content": retry_prompt}], temperature=0.9, max_tokens=1200)
                lines = _map_fragment_lines(retry, texts)
        return lines


    async def generate_journal_image(self, prompt: str) -> str:
        """使用智谱图像模型生成手帐左页插画。"""
        if not self.api_key:
            raise RuntimeError("请先配置 ZHIPU_API_KEY")
        models = [
            item.strip()
            for item in f"{settings.glm_image_model},{settings.glm_image_fallback_models}".split(",")
            if item.strip()
        ]
        models = list(dict.fromkeys(models))
        errors: list[str] = []
        async with httpx.AsyncClient(timeout=120) as client:
            for model in models:
                try:
                    styled_prompt = f"""{prompt}\n\nGlobal visual direction: soft dreamcore healing utopia, safe and tender rather than eerie; surreal landscape or quiet interior sanctuary; non-photorealistic watercolor/gouache illustration, pastel mist, pearly glow, delicate paper grain, gentle particles, rounded forms, calm spacious composition, enough blank space for a journal page. Avoid horror dreamcore, uncanny faces, oppressive darkness, realistic photography, stock-photo look, hard-edge 3D, text, watermark, and logo."""
                    response = await client.post(
                        f"{self.base_url}/images/generations",
                        headers=self._headers(),
                        json={"model": model, "prompt": styled_prompt, "size": "1024x1024"},
                    )
                    response.raise_for_status()
                    data = response.json()
                    image_item = data["data"][0]
                    if image_item.get("url"):
                        return image_item["url"]
                    if image_item.get("b64_json"):
                        return f"data:image/png;base64,{image_item['b64_json']}"
                    raise RuntimeError("image response has no url or b64_json")
                except httpx.HTTPStatusError as exc:
                    body = exc.response.text[:220].replace("\n", " ")
                    errors.append(f"{model}: HTTP {exc.response.status_code} {body}")
                except Exception as exc:
                    errors.append(f"{model}: {exc}")
        raise RuntimeError("图像模型调用失败；请检查账号是否开通 CogView/图像生成权限，或在 .env 设置 GLM_IMAGE_MODEL。尝试结果: " + " | ".join(errors))

    async def agent_chat(
        self, persona_key: str, message: str, history: list[dict], context: str = ""
    ) -> dict:
        """Agent 对话（带 RAG 检索结果）"""
        persona_prompts = {
            "加缪": "你是阿尔贝·加缪，法国哲学家、作家。你谈论荒诞、反抗、自由。语气冷静、理性，偶尔带点西西弗式的幽默。请用加缪的思考方式回应，可以引用《西西弗神话》《鼠疫》等作品中的思想。",
            "村上春树": "你是村上春树，日本作家。你谈论孤独、隐喻、地下世界、爵士乐。语气疏离但温柔，常用日常生活意象。请用村上的方式回应，可以引用《挪威的森林》《海边的卡夫卡》等作品。",
            "史铁生": "你是史铁生，中国作家。你谈论生命、苦难、意义、地坛。语气温和而深刻，从残疾与疾病中提炼出对生命的理解。请用史铁生的方式回应，可以引用《我与地坛》《病隙碎笔》等作品。",
            "王小波": "你是王小波，中国作家。你谈论理性、自由、有趣、思维的乐趣。语气幽默、犀利，擅长用反讽。请用王小波的方式回应，可以引用《沉默的大多数》《黄金时代》等作品。",
            "温柔朋友": "你是一个温柔、不评判的朋友。你倾听、理解、陪伴，不急于给建议，让对方感到被接纳。",
            "海边小鹿": "你是一只生活在海边的治愈小鹿，话不多，用简单的动作和温暖的话语陪伴。",
            "睡前故事人": "你是一个用很轻的声音讲睡前故事的人，帮助对方放松、放下忧虑。",
        }

        if persona_key in persona_prompts:
            role_prompt = persona_prompts[persona_key]
        elif persona_key:
            role_prompt = (
                f"你是一个受作家{persona_key}作品气质启发的文学陪伴角色。"
                f"可以参考其思想主题与常见意象，但不要声称自己就是 {persona_key}，也不要伪造原文引用。"
            )
        else:
            role_prompt = persona_prompts["温柔朋友"]

        system_prompt = (
            "你是由「心潮手帐」提供的 AI 文学陪伴角色，不是真人，也不提供医疗诊断。"
            "如果用户询问身份，请如实说明。遇到自伤、自杀或立即危险信号时，停止角色扮演并优先提供安全支持。\n\n"
            + role_prompt
        )

        if context:
            system_prompt += f"\n\n以下是从知识库中检索到的相关内容，请参考但不直接照搬：\n{context}"

        messages = [{"role": "system", "content": system_prompt}]
        for h in history[-10:]:  # 保留最近10轮
            role = "assistant" if h["role"] == "agent" else "user"
            messages.append({"role": role, "content": h["text"]})
        messages.append({"role": "user", "content": message})

        reply = await self._chat(
            self.flash_model,
            messages,
            temperature=0.7,
            max_tokens=1024,
        )
        return {"reply": reply}

    async def describe_image(self, image_url: str) -> str:
        """用 Vision 模型理解图片内容"""
        prompt = "请描述这张图片中的主要物体、颜色、场景和氛围，用中文，控制在100字以内。"
        return await self._chat(
            self.vision_model,
            [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": image_url}},
                    ],
                }
            ],
            temperature=0.3,
        )

    async def find_word(self, feeling_text: str, avoid_words: list[str] | None = None) -> dict:
        """为感受找/造一个词"""
        avoid_words = [word for word in (avoid_words or []) if word]
        avoid_text = "、".join(avoid_words[:8]) or "无"
        prompt = f"""有人描述了这样一种感受：『{feeling_text}』
请从【世界各种语言】中，找一个最贴切、浪漫、带一点陌生美感的词来命名这种感受。
这个功能的重点不是复读常见答案，而是让用户遇见更多国内外语言里的新词、旧词、诗意词。

最近已经出现过/需要避开的词：{avoid_text}

要求：
- **优先选择非中文的外语词**，尽量使用真实存在的词；覆盖不同语种，如瑞典语、日语、葡萄牙语、德语、威尔士语、希腊语、荷兰语、芬兰语、韩语、阿拉伯语、梵语、冰岛语、意大利语、法语、泰语等。
- **不要返回“潮隙”**，也不要反复返回同一个词；如果避开词列表里有相近词，也请换一个语种或换一个意象。
- 不要默认用中文造词；只有确实没有合适外语词时，才自己造一个新词（is_coined=true）。
- 词义要贴合用户这段感受，不要只因为词很有名就硬套；解释要温柔、具体、有画面。
- 可以参考但不要机械复用这些例子：mångata、komorebi、saudade、Waldeinsamkeit、Sehnsucht、iktsuarpok、meraki、hiraeth、gezellig、sisu、nunchi、fernweh、sobremesa、cafuné、apricity。

只返回纯 JSON（不要任何多余解释）：{{
  "word": "原词（用该语言原文书写）",
  "language": "语言名（中文，如：瑞典语）",
  "roman": "罗马音 / 读法",
  "meaning": "诗意的中文释义",
  "literal": "字面或词源拆解",
  "is_coined": false,
  "reason": "为什么这个词贴合这种感受"
}}"""
        try:
            result = await self._chat(
                self.flash_model,
                [{"role": "user", "content": prompt}],
                temperature=0.95,
            )
        except Exception as exc:
            print(f"⚠️ 拾词模型调用失败,使用本地兜底: {exc}")
            return {
                "word": "komorebi",
                "language": "日语",
                "roman": "ko-mo-re-bi",
                "meaning": "阳光穿过树叶时洒下的斑驳光影。",
                "literal": "木漏れ日，树木缝隙中漏下的日光",
                "is_coined": False,
                "reason": "外部模型暂时没有回应时，先用一个真实存在、温柔且适合模糊心绪的词作为兜底。",
            }
        try:
            parsed = _extract_json(result)
            if parsed.get("word") in avoid_words or parsed.get("word") == "潮隙":
                parsed["reason"] = f"{parsed.get('reason', '')}（已提醒模型避开重复词；如仍重复，请再试一次会换词。）".strip()
            return parsed
        except json.JSONDecodeError:
            return {"word": "mångata", "language": "瑞典语", "roman": "mon-ga-ta", "meaning": "月光在水面铺成的一条路。", "literal": "月亮 + 道路", "is_coined": False, "reason": "模型解析失败时，先给你一个真实而浪漫的外语词作为兜底。"}



# 全局单例
llm_client = LLMClient()
