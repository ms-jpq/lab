set global auto_save_on_exit=false

m4_define([LOCAL_NAME], m5_assert([ENV_INITIATOR_NAME]))
m4_define([LOCAL_PREFIX], [LOCAL_NAME])

m4_define([SHARING], [
m4_pushdef([NAME], [$1])
m4_pushdef([BLOCK_DEVICE], [$2])
m4_pushdef([REMOTE_INITIATORS], [m4_shift(m4_shift($@))])

cd /

cd /backstores/block
create NAME BLOCK_DEVICE

cd /iscsi
create LOCAL_NAME@NAME

cd /iscsi/LOCAL_NAME@NAME/tpg1/portals
delete 0.0.0.0 3260
create ::0

cd /iscsi/LOCAL_NAME@NAME/tpg1/luns
create /backstores/block/NAME

cd /iscsi/LOCAL_NAME@NAME/tpg1/acls
m5_for([INITIATOR], [
create LOCAL_PREFIX:INITIATOR
], REMOTE_INITIATORS)

])

m5_for([SHARE], [
SHARING(SHARE)
], m5_assert([ENV_SHARES]))

cd /
saveconfig
ls
