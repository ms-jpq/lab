from typing import TYPE_CHECKING, TypeAlias

if TYPE_CHECKING:

    class CustomLogger: ...

else:
    from litellm.integrations.custom_logger import CustomLogger


Message: TypeAlias = dict[str, object]


def _is_function_tool(tool: object) -> bool:
    match tool:
        case {"type": "function"}:
            return True
        case _:
            return False


def _drop_blank_assistant_between_tool_call_and_result(messages: object) -> object:
    if not isinstance(messages, list):
        return messages

    normalized: list[object] = []
    for index, message in enumerate(messages):
        next_message = messages[index + 1] if index + 1 < len(messages) else None
        previous = normalized[-1] if normalized else None

        match previous:
            case {"role": "assistant", "tool_calls": [*tool_calls]} if tool_calls:
                match message:
                    case {
                        "role": "assistant",
                        "content": None | "" | [],
                    } if not message.get("tool_calls"):
                        match next_message:
                            case {"role": "tool", "tool_call_id": tool_call_id}:
                                if any(
                                    isinstance(tool_call, dict)
                                    and tool_call.get("id") == tool_call_id
                                    for tool_call in tool_calls
                                ):
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
            kwargs["messages"] = _drop_blank_assistant_between_tool_call_and_result(
                msgs
            )
        return kwargs


codex_tool_filter = _CodexToolFilter()
