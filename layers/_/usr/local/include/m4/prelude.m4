m4_divert(`-1')
m4_changequote(`[', `]')
m4_changecom([], [])
m4_define([m5_or], [m4_ifdef([$1], [$1], [$2])])
m4_define([m5_assert], [m4_ifdef([$1], [$1], [m4_errprint(m4___file__:m4___line__ >? [$1])m4_m4exit([1])])])
m4_define([m5_for], [m4_pushdef([$1], [$3])m4_ifelse($#, [3], [m4_ifelse([$3], [], [], [$2])], [$2[]$0([$1], [$2], m4_shift(m4_shift(m4_shift($@))))])[]m4_popdef([$1])])
m4_divert([0])m4_dnl
