[[Unit]]
After = 1-ip-alloc@wg0.service

# m5_for([IF_NAME], [
After = 1-ip-alloc@IF_NAME.service
# ], m5_assert([ENV_IFS]))
