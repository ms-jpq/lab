from typing import TYPE_CHECKING, TypeAlias

if TYPE_CHECKING:

    class CustomLogger: ...

else:
    from litellm.integrations.custom_logger import CustomLogger


Message: TypeAlias = dict[str, object]


# TODO: https://github.com/BerriAI/litellm/issues/27276
def _is_function_tool(tool: object) -> bool:
    match tool:
        case {"type": "function"}:
            return True
        case _:
            return False


# TODO: https://github.com/BerriAI/litellm/issues/31553
def _is_blank_content(content: object) -> bool:
    match content:
        case None:
            return True
        case str():
            return content.strip() == ""
        case list():
            return all(
                isinstance(part, dict)
                and part.get("type") == "text"
                and not (part.get("text") or "").strip()
                for part in content
            )
        case _:
            return False


def _has_tool_calls(message: object) -> bool:
    match message:
        case {"tool_calls": [*tool_calls]} if tool_calls:
            return True
        case _:
            return False


# TODO: https://github.com/BerriAI/litellm/pull/31559
def _drop_blank_assistant_after_tool_calls(messages: object) -> object:
    if not isinstance(messages, list):
        return messages

    normalized: list[object] = []
    for message in messages:
        previous = normalized[-1] if normalized else None

        match previous:
            case {"role": "assistant"} if _has_tool_calls(previous):
                match message:
                    case {
                        "role": "assistant",
                    } if not _has_tool_calls(
                        message
                    ) and _is_blank_content(message.get("content")):
                        continue
                    case _:
                        pass
            case _:
                pass

        normalized.append(message)

    return normalized


class _CodexToolFilter(CustomLogger):
    async def async_pre_call_hook(
        self,
        user_api_key_dict: object,
        cache: object,
        data: Message,
        call_type: object,
    ) -> Message:
        match data.get("tools"):
            case [*tools]:
                data["tools"] = [tool for tool in tools if _is_function_tool(tool)]
            case _:
                pass

        data.pop("web_search_options", None)
        return data

    async def async_pre_call_deployment_hook(
        self,
        kwargs: Message,
        call_type: object,
    ) -> Message:
        if msgs := kwargs.get("messages"):
            kwargs["messages"] = _drop_blank_assistant_after_tool_calls(msgs)
        return kwargs


codex_tool_filter = _CodexToolFilter()
