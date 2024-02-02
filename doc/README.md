# Welcome to my pet cloud.

## Design Goals

### [DX](https://github.com/ms-jpq/lab/blob/main/doc/DX.md)

- [x] 100ms max iteration time

- [x] Idempotent deployment + instant rollback

- [x] Daily + continuous CI verification

- [?] Minimum maintenance

## Cloud

## [Private](https://github.com/ms-jpq/lab/blob/main/doc/PRIVATE_CLOUD.md)

- [x] Sub-second VM / Container spin up/down

- [x] Scale to zero + network activated lambdas / VM / containers

- [x] Overlay networks + recursive DNS service discovery / registration

- [x] GPU (CUDA & mdev) VM / containers

- [x] HTTP + IMAP single sign on

## [Hybrid](https://github.com/ms-jpq/lab/blob/main/doc/NETWORK.md)

- [x] VPN gateways

- [x] Terraform → Route 53 + EBS + VPC + Launch Template + AMI + EC2

- [x] Terraform → AWS LightSail: DNS + Block Storage + VM
