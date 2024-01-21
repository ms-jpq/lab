# Hyper-V

Seems to be a CPU hardware problem with intel 12gen CPUs

```txt
https://forum.level1techs.com/t/intel-12th-gen-cpu-not-working-with-qemu-hyper-v-nested-virtualization/185068
```

Changing `-cpu` to another model helps with BSOD when enabling hyper-v

But you are stuck with that CPU version forever, as far as windows is concerned.
