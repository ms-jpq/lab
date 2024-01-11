variable "oci_region" {
  type = string
}

provider "oci" {
  region = var.oci_region
}
