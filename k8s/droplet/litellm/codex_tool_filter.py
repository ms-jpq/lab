import litellm  # type: ignore


class _CodexToolFilter:
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


litellm.callbacks = [_CodexToolFilter()]  # type: ignore
