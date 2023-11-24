<?php

$config["imap_conn_options"] = $config["smtp_conn_options"] = [
  "ssl" => ["allow_self_signed" => true, "verify_peer_name" => false],
];

?>
