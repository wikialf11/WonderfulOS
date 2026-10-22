// Navegador: en la app de escritorio usa el Chromium de WonderfulOS; en el
// servicio local usa el navegador ligero que muestra las webs dentro de la ventana.
// El Llavero guarda tus contraseñas cifradas en este equipo, aparte del sistema.
export default {
  id: 'navegador',
  name: 'Navegador',
  description: 'Navega por internet y descarga a Archivos',

  async launch(ctx, startUrl) {
    if (window.nubeosDesktop) {
      const { default: local } = await import('./navegador-local.js');
      return local.launch(ctx, startUrl);
    }
    const { default: ligero } = await import('./navegador-ligero.js');
    return ligero.launch(ctx, startUrl);
  },
};
