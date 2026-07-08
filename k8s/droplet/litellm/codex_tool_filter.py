from logging import getLogger
from typing import TYPE_CHECKING, TypeAlias

if TYPE_CHECKING:

    class CustomLogger: ...

else:
    from litellm.integrations.custom_logger import CustomLogger


Message: TypeAlias = dict[str, object]

_log = getLogger(__name__)


# TODO: https://github.com/BerriAI/litellm/issues/27276
def _is_function_tool(tool: object) -> bool:
    match tool:
        case {"type": "function"}:
            return True
        case _:
            return False


def _extract_function_tools(tools: list[object]) -> list[object]:
    normalized: list[object] = []
    for tool in tools:
        match tool:
            case {"type": "namespace", "tools": [*nested]}:
                normalized.extend(
                    nested_tool
                    for nested_tool in nested
                    if _is_function_tool(nested_tool)
                )
            case _ if _is_function_tool(tool):
                normalized.append(tool)
            case _:
                pass

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
                data["tools"] = _extract_function_tools(tools)
            case _:
                pass

        data.pop("web_search_options", None)
        return data


codex_tool_filter = _CodexToolFilter()
