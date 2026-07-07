from litellm.integrations.custom_logger import CustomLogger  # type: ignore


class _CodexToolFilter(CustomLogger):
    async def async_pre_call_hook(self, user_api_key_dict, cache, data, call_type):
        tools = data.get("tools")
        if isinstance(tools, list):
            data["tools"] = [
                tool
                for tool in tools
                if isinstance(tool, dict) and tool.get("type") == "function"
            ]
        data.pop("web_search_options", None)
        return data


codex_tool_filter = _CodexToolFilter()
