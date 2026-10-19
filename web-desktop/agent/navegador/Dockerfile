# Navegador de WonderfulOS: Chromium de neko (https://github.com/m1k1o/neko) con los
# idiomas de Chromium, para que se vea en español.
FROM ghcr.io/m1k1o/neko/chromium:latest
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium-l10n locales fonts-noto-color-emoji \
 && sed -i 's/^# *es_ES.UTF-8/es_ES.UTF-8/' /etc/locale.gen && locale-gen \
 && rm -rf /var/lib/apt/lists/*
