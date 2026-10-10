# Linux leg of the Phase 0 keyboard probe (scripts/qa-keyboard-probe.mjs linux).
# Xvfb + openbox give real X key events through xdotool (XTEST); Chrome stable comes from Google's apt repository
# and Firefox stable from Mozilla's, for the container's native architecture.
FROM debian:trixie-slim

# deb.debian.org was about 100 KB/s from Docker Desktop's network on the owner's Mac; pass a closer mirror host for the
# main archive (security updates stay on deb.debian.org, which mirrors often do not carry).
ARG DEBIAN_MIRROR=deb.debian.org
RUN sed -i "s|http://deb.debian.org/debian\$|http://${DEBIAN_MIRROR}/debian|" /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg xvfb xdotool wmctrl openbox imagemagick nodejs fonts-noto-cjk procps x11-utils dbus dbus-x11 \
  && install -d -m 0755 /etc/apt/keyrings \
  && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /etc/apt/keyrings/google.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/google.gpg] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
  && curl -fsSL https://packages.mozilla.org/apt/repo-signing-key.gpg -o /etc/apt/keyrings/packages.mozilla.org.asc \
  && echo "deb [signed-by=/etc/apt/keyrings/packages.mozilla.org.asc] https://packages.mozilla.org/apt mozilla main" > /etc/apt/sources.list.d/mozilla.list \
  && printf 'Package: *\nPin: origin packages.mozilla.org\nPin-Priority: 1000\n' > /etc/apt/preferences.d/mozilla \
  && apt-get update \
  && apt-get install -y --no-install-recommends google-chrome-stable firefox \
  && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home probe
USER probe
WORKDIR /home/probe
