m4_define(`m5_foreach', `m4_pushdef(`$1', `$3')m4_ifelse($#, `3', `m4_ifelse(`$3', , , `$2')', `$2m5_foreach(`$1', `$2', m4_shift(m4_shift(m4_shift($@))))')m4_popdef(`$1')')m4_dnl
