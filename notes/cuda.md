# CUDA

## Tensorflow

```bash
PCI="$(lspci -mm | awk '/VGA/ && /NVIDIA/ { print "0000:"$1 }')"
printf -- '%s' 0 >"/sys/bus/pci/devices/$PCI/numa_node"
```
