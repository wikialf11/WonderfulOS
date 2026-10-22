// Genera los recursos gráficos de la ISO a partir del diseño del prototipo:
// tema de iconos "WonderfulOS" (apps, carpetas y archivos) y el fondo de pantalla.
// Uso: node os/iso/tools/gen-assets.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ICONS, FILE_ICONS } from '../../../web-desktop/js/shell/icons.js';

const root = fileURLToPath(new URL('../config/includes.chroot/usr/share/', import.meta.url));
const theme = `${root}icons/NubeOS/`;
const put = (dir, names, svg) => {
  mkdirSync(theme + dir, { recursive: true });
  for (const n of names) writeFileSync(`${theme}${dir}/${n}.svg`, svg);
};

// Apps: nombres propios de WonderfulOS y los nombres estándar que usan las apps.
put('scalable/apps', ['nubeos-navegador', 'firefox-esr', 'firefox', 'web-browser'], ICONS.navegador);
put('scalable/apps', ['nubeos-archivos', 'org.kde.dolphin', 'system-file-manager'], ICONS.archivos);
put('scalable/apps', ['nubeos-ajustes', 'systemsettings', 'preferences-system'], ICONS.ajustes);
put('scalable/apps', ['nubeos-launchpad', 'start-here-kde', 'start-here-kde-plasma', 'start-here-kde-symbolic', 'start-here-kde-plasma-symbolic', 'start-here-symbolic', 'start-here-debian', 'debian-logo', 'kde', 'plasma', 'org.kde.plasma.kickerdash', 'applications-all'], ICONS.launchpad);
put('scalable/apps', ['nubeos-logo', 'start-here', 'distributor-logo', 'install-debian', 'calamares', 'system-software-install'], ICONS.logo);
put('scalable/apps', ['nubeos-buscar', 'krunner', 'system-search'], ICONS.buscar);
put('scalable/places', ['user-trash', 'user-trash-full', 'trash-empty'], ICONS.papelera);
put('scalable/places', ['folder', 'inode-directory', 'folder-documents', 'folder-download', 'folder-pictures', 'user-home', 'folder-blue'], FILE_ICONS.folder);
put('scalable/mimetypes', ['text-plain', 'application-pdf', 'x-office-document'], FILE_ICONS.text);
put('scalable/mimetypes', ['x-office-spreadsheet', 'text-csv'], FILE_ICONS.sheet);
put('scalable/mimetypes', ['x-office-presentation'], FILE_ICONS.slides);
put('scalable/mimetypes', ['image-x-generic', 'image-png', 'image-jpeg'], FILE_ICONS.image);
put('scalable/mimetypes', ['application-zip', 'application-x-compressed-tar', 'package-x-generic'], FILE_ICONS.archive);
put('scalable/mimetypes', ['application-x-executable', 'application-vnd.appimage', 'application-x-deb'], FILE_ICONS.app);
put('scalable/mimetypes', ['unknown', 'text-x-generic'], FILE_ICONS.file);

writeFileSync(`${theme}index.theme`, `[Icon Theme]
Name=WonderfulOS
Comment=Iconos de WonderfulOS
Inherits=Papirus,breeze,hicolor
Directories=scalable/apps,scalable/places,scalable/mimetypes

[scalable/apps]
Size=64
MinSize=16
MaxSize=512
Type=Scalable
Context=Applications

[scalable/places]
Size=64
MinSize=16
MaxSize=512
Type=Scalable
Context=Places

[scalable/mimetypes]
Size=64
MinSize=16
MaxSize=512
Type=Scalable
Context=MimeTypes
`);

console.log('Recursos generados en', root);
