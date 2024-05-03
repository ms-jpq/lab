provider "google" {
  alias = "root"
}

resource "google_project" "dalaran" {
  provider   = google.root
  name       = "dalaran"
  project_id = "dalaran-2"
}

resource "google_project" "kalimdor" {
  provider   = google.root
  name       = "kalimdor"
  project_id = "kalimdor-2"
}

# resource "google_project" "lordaeron" {
#   provider   = google.root
#   name       = "lordaeron"
#   project_id = "lordaeron-2"
# }

output "gcp_projects" {
  value = {
    dalaran  = google_project.dalaran.project_id
    kalimdor = google_project.kalimdor.project_id
  }
}
