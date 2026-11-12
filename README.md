# Crowther

**IDE de diseño narrativo para crear ficción interactiva y librojuegos digitales.**

Crowther es una aplicación web ligera, en español, hecha con HTML, CSS y JavaScript. Permite diseñar escenas visuales, enlazarlas mediante decisiones y probar o exportar aventuras sin instalar dependencias de npm.

| Ficha | Valor |
|---|---|
| Versión | 1.0.0 |
| Idioma de esta versión | Español |
| Licencia del IDE | GNU GPL v3 (GPL-3.0-only) |
| Autoría | © Jacobo Feijóo |

## Funciones

- Editor visual de escenas con imágenes, cajas de diálogo y decisiones movibles, redimensionables y organizadas por capas.
- Árbol de escenas y grafo de decisiones; admite ramificaciones y finales valorados.
- Texto enriquecido con Quill para diálogos y notas.
- Recursos de imagen, sonido y vídeo; transiciones, pistas, mapas y objetos combinables.
- Inventario de juego, notas de partida, ficha de personaje, retos Quiz, combates y eventos.
- Prueba de la aventura desde el IDE y exportación como HTML autónomo o paquete ZIP para hosting.
- PWA instalable. La carcasa del IDE puede abrirse sin conexión después de la primera carga; los proyectos permanecen en el almacenamiento local del navegador.

## Ejecutar Crowther

No abras `index.html` directamente con `file://`: los módulos JavaScript necesitan un servidor local.

**Windows:** doble clic en `Abrir Crowther.cmd`. Necesita Python 3 y abre Crowther en el navegador.

**Linux:**

```sh
chmod +x "Abrir Crowther Linux.sh" scripts/abrir-crowther-unix.sh
./"Abrir Crowther Linux.sh"
```

**macOS:**

```sh
chmod +x "Abrir Crowther Mac.command" scripts/abrir-crowther-unix.sh
./"Abrir Crowther Mac.command"
```

Los lanzadores de Linux y macOS también requieren Python 3. Para publicar Crowther online como PWA, sube los archivos de la release manteniendo sus carpetas y sirve el sitio mediante HTTPS.

## Proyectos y exportación

El proyecto y sus medios se guardan en IndexedDB del navegador y dispositivo actuales; no se sincronizan automáticamente entre equipos. Usa **Exportar proyecto** para conservar una copia editable. La exportación web puede generar un HTML único o un ZIP con los archivos y recursos separados.

## Validación local

En PowerShell, ejecuta:

```powershell
./scripts/Validar-Proyecto.ps1
```

El repositorio incluye pruebas locales del modelo, almacenamiento, exportación, escenas, personajes, PWA, teclado, combates y eventos.

## Licencia y atribución

El código del IDE se distribuye bajo **GNU GPL versión 3**. Al redistribuir Crowther o una versión modificada, conserva el aviso de autoría «© Jacobo Feijóo» según `COPYRIGHT-ATTRIBUTION.txt`.

Las aventuras exportadas pueden elegir su propia licencia gracias a la excepción del runtime descrita en `RUNTIME-LICENSE-EXCEPTION.txt`. Esa excepción no cambia la licencia del IDE y exige conservar el crédito del motor y los avisos de terceros que correspondan. El contenido que cree cada autor sigue siendo suyo.

Quill y Cytoscape.js se distribuyen localmente en `vendor/`; sus licencias y avisos deben conservarse al redistribuirlos.

## Idioma

La interfaz y la documentación de esta versión están en español. Las aventuras pueden contener texto en Unicode y otros idiomas; no se ofrece aún una interfaz traducida.
