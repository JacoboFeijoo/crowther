# Protocolo de scripts locales

Objetivo: resolver con automatización local las tareas repetibles y devolver solo la evidencia necesaria. Así se evitan comandos reconstruidos en cada turno, salidas enormes y consumo de contexto innecesario.

## Antes de ejecutar

1. Leer las instrucciones aplicables (`AGENTS.md`, si existe, y este protocolo).
2. Revisar `scripts/` y reutilizar el script que ya cubra la tarea. No redescubrir con comandos largos algo que el script ya resume.
3. Preferir herramientas locales y disponibles. Este proyecto es HTML/CSS/JavaScript sin dependencias npm: no instalar paquetes para una comprobación simple.
4. Si la tarea se repetirá o necesita evidencia reproducible, crear o ampliar un script; para una acción irrepetible y trivial, usar el comando directo.

## Cómo deben ser los scripts

- Mantenerlos en `scripts/`, con nombre descriptivo y parámetros explícitos.
- Anclar rutas al propio script (`$PSScriptRoot`), no al directorio desde el que se invoque.
- Hacerlos idempotentes cuando sea posible: repetirlos no debe duplicar ni alterar datos inesperadamente.
- Mantener el alcance pequeño. No añadir dependencias, llamadas de red ni cambios de configuración global si no son necesarios.
- Separar comprobación de modificación. Las operaciones destructivas deben requerir confirmación explícita, resolver y validar primero los destinos exactos y ofrecer vista previa cuando sea viable.
- No borrar backups ni evidencias automáticamente; no escribir claves, tokens ni datos sensibles en registros.
- En PowerShell, favorecer compatibilidad con Windows PowerShell 5.1 mientras no haya una razón para exigir otra versión.
- Dar un código de salida útil: `0` si la comprobación terminó correctamente, distinto de cero si falló o quedó incompleta. Nunca presentar una omisión como validación satisfactoria.

## Ahorro de tokens y evidencia

- La salida normal debe ser un resumen breve: resultado, cantidad comprobada y errores concretos.
- No imprimir archivos completos, listados enormes, progreso por cada elemento ni logs de éxito repetitivos.
- Mostrar detalles solo de los fallos; limitar el fragmento si una herramienta produce demasiada salida. Guardar un log local únicamente cuando haga falta para investigar, e informar su ruta.
- Usar una opción JSON compacta cuando otro script o una automatización necesite consumir el resultado.
- No confundir validación automática con juicio humano: los cambios de interfaz aún requieren probar el flujo visible cuando haya navegador disponible. Informar por separado lo comprobado y lo pendiente.

## Scripts de este proyecto

Validación estática ligera:

```powershell
& .\scripts\Validar-Proyecto.ps1
```

Para obtener una respuesta legible por otra automatización:

```powershell
& .\scripts\Validar-Proyecto.ps1 -Json
```

El validador comprueba archivos base, sintaxis de los archivos `js/*.js` con Node.js, flujos de modelo, creación de proyectos, exportación web, almacenamiento, controles de desplazamiento por teclado, combates, personajes y que la release permanezca separada de los contadores opcionales. `scripts/Probar-NuevoProyecto.mjs` verifica la estructura en blanco, la detección de trabajo que requiere confirmación y el orden de los controles; `scripts/Probar-Exportacion-Web.mjs` verifica el HTML autocontenido y la estructura, rutas, recursos y CRC del ZIP; `scripts/Probar-Almacenamiento-IndexedDB.mjs` simula la migración, la separación de metadatos y blobs, la recarga, la exportación transportable y la limpieza de recursos retirados; `scripts/Probar-Desplazamiento-Teclado.mjs` comprueba movimiento normal/acelerado de imágenes, diálogos, decisiones y el rótulo «¿Qué decides?», redimensión independiente de decisiones, guías de alineación, el bloqueo del desplazamiento de página, el foco al seleccionar y la eliminación con Supr cuando un redibujado ha devuelto el foco a `body`; `scripts/Probar-Modelo-ModulosRecursos.mjs` valida persistencia, renombrado y retirada de atributos globales de objetos y sus valores por recurso; `scripts/Probar-Combates.mjs` valida persistencia de la ilustración de atributos, copia de valores de objeto, nombres de tarjetas de recursos, tiradas aleatorias deterministas, fórmulas, salud y resultados; `scripts/Probar-Personajes.mjs` valida ficha, perfiles, reparto de puntos, progreso, efectos por ronda y recompensas de victoria. No inicia un servidor ni sustituye la comprobación manual del editor.
