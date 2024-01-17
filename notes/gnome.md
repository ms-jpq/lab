# Gnome

## Sleep

```bash
gsettings set org.gnome.desktop.session idle-delay 3600
```

## Remote

```bash
# Cant be root
ssh '<gui-user>@<domain>'

systemctl --user enable --now -- gnome-remote-desktop.service

# conf -> ~/.config/dconf/user
grdctl status
# https://extensions.gnome.org/extension/4338/allow-locked-remote-desktop/ ???
```

### VNC

```bash
grdctl vnc enable
grdctl vnc disable-view-only
grdctl vnc set-auth-method password

rm -v --force --recursive -- ~/.local/share/keyrings/login.keyring
# probably need to run this on actual machine
grdctl vnc set-password "$PASSWORD"
```

### RDP

```bash
grdctl rdp enable
grdctl rdp disable-view-only
grdctl rdp set-auth-method password

grdctl rdp set-tls-cert "$XDG_RUNTIME_DIR/gnome-remote-desktop/ssl.crt"
grdctl rdp set-tls-key "$XDG_RUNTIME_DIR/gnome-remote-desktop/ssl.key"

grdctl rdp set-credentials "$USER" "$PASSWORD"
```
