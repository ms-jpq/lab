from typing import TYPE_CHECKING

if TYPE_CHECKING:

    class CustomLogger: ...

else:
    from litellm.integrations.custom_logger import CustomLogger


def _is_message(item: object) -> bool:
    match item:
        case {"type": "message"} | {"role": str()}:
            return True
        case _:
            return False


# TODO: https://github.com/deepseek-ai/DeepSeek-V3/issues/1588
def _group_tool_outputs(items: list[object]) -> list[object]:
    result: list[object] = []
    batch: list[object] = []
    pending: set[tuple[str, str]] = set()

    for item in items:
        match item:
            case {
                "type": "function_call" | "custom_tool_call" as kind,
                "call_id": str(call_id),
            }:
                pending.add((kind, call_id))
            case {
                "type": "function_call_output" | "custom_tool_call_output" as kind,
                "call_id": str(call_id),
            }:
                pending.discard((kind.removesuffix("_output"), call_id))

        if pending or batch:
            batch.append(item)
            if not pending:
                result.extend(sorted(batch, key=_is_message))
                batch.clear()
        else:
            result.append(item)

    result.extend(batch)
    return result


class _CodexToolFilter(CustomLogger):
    async def async_pre_call_hook(
        self,
        user_api_key_dict: object,
        cache: object,
        data: dict[str, object],
        call_type: object,
    ) -> dict[str, object]:
        match data:
            case {"model": str(model), "input": [*items]} if model.startswith(
                "deepseek/"
            ):
                return {**data, "input": _group_tool_outputs(items)}
            case _:
                return data


codex_tool_filter = _CodexToolFilter()
