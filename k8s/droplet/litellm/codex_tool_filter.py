from litellm.caching.caching import DualCache
from litellm.integrations.custom_guardrail import CustomGuardrail
from litellm.proxy._types import UserAPIKeyAuth
from litellm.types.utils import CallTypes


class CodexToolFilterGuardrail(CustomGuardrail):
    async def async_pre_call_hook(
        self,
        user_api_key_dict: UserAPIKeyAuth,
        cache: DualCache,
        data: dict,
        call_type: CallTypes | None,
    ) -> Exception | str | dict | None:
        tools = data.get("tools")
        if isinstance(tools, list):
            data["tools"] = [
                tool
                for tool in tools
                if isinstance(tool, dict) and tool.get("type") == "function"
            ]
        data.pop("web_search_options", None)
        return data
