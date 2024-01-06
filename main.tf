data "http" "gh_keys" {
  url = "https://github.com/${var.github_user}.keys"
}

locals {
  ssh_keys  = split("\n", trimspace(data.http.gh_keys.response_body))
  user_data = base64encode(templatefile("${path.module}/cloud-init/user-data.yml", { ssh_keys = jsonencode(local.ssh_keys) }))
}

provider "aws" {
  region = var.aws_region
}

resource "aws_vpc" "fastx" {
  assign_generated_ipv6_cidr_block = true
  cidr_block                       = "10.0.0.0/16"
  enable_dns_hostnames             = true
}

resource "aws_internet_gateway" "silkroad" {
  vpc_id = aws_vpc.fastx.id
}

resource "aws_subnet" "onlyfams" {
  assign_ipv6_address_on_creation = true
  cidr_block                      = cidrsubnet(aws_vpc.fastx.cidr_block, 8, 0)
  ipv6_cidr_block                 = cidrsubnet(aws_vpc.fastx.ipv6_cidr_block, 8, 0)
  map_public_ip_on_launch         = true
  vpc_id                          = aws_vpc.fastx.id
}

resource "aws_route_table" "vinethanol" {
  vpc_id = aws_vpc.fastx.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.silkroad.id
  }

  route {
    gateway_id      = aws_internet_gateway.silkroad.id
    ipv6_cidr_block = "::/0"
  }
}

resource "aws_route_table_association" "vinfast" {
  route_table_id = aws_route_table.vinethanol.id
  subnet_id      = aws_subnet.onlyfams.id
}

resource "aws_security_group" "acab" {
  name = "nypd"
  ingress {
    cidr_blocks = ["0.0.0.0/0"]
    from_port   = 0
    protocol    = "-1"
    to_port     = 0
  }
  ingress {
    from_port        = 0
    ipv6_cidr_blocks = ["::/0"]
    protocol         = "-1"
    to_port          = 0
  }
  egress {
    cidr_blocks = ["0.0.0.0/0"]
    from_port   = 0
    protocol    = "-1"
    to_port     = 0
  }
  egress {
    from_port        = 0
    ipv6_cidr_blocks = ["::/0"]
    protocol         = "-1"
    to_port          = 0
  }
}

resource "aws_launch_template" "u-jammy" {
  image_id  = "ami-0a24e6e101933d294" # Ubuntu 22.04 arm64
  name      = "u-jammy"
  user_data = local.user_data

  network_interfaces {
    security_groups = [aws_security_group.acab.id]
    subnet_id       = aws_subnet.onlyfams.id
  }

  block_device_mappings {
    device_name = "/dev/sda1"
    ebs {
      volume_size = 50
      volume_type = "gp3"
    }
  }
}

# resource "aws_instance" "droplet" {
#   instance_type = "t4g.small"
#   launch_template {
#     id = aws_launch_template.u-jammy.id
#   }
# }
