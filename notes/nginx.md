# Nginx

## Sub Filter

```nginx
sub_filter_once  off;
sub_filter       "<regex>" "<replacement>";
# need to use plain text
proxy_set_header Accept-Encoding "";
```
