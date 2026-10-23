# Datos del motor de conocimiento

Esta carpeta alimenta el modo **Lógica** de Agentic. El motor es 100 % simbólico: no hay modelo
neuronal, no hay entrenamiento por gradientes y no se llama a Ollama.

## Ficheros

| Fichero | Contenido | Origen |
|---|---|---|
| `seed-lexico.json` | 103 conceptos curados con definición, género, sinónimos, ejemplos y relaciones. | Contenido original de WonderfulOS. |
| `reglas.json` | Reglas de inferencia hacia adelante (transitividad, simetría, herencia). | Contenido original de WonderfulOS. |
| `documentos-ejemplo.json` | Tres textos breves para probar la recuperación BM25. | Contenido original de WonderfulOS. |
| `mcr-es.json` | 18.913 synsets con lemas, categoría, definición y ejemplos. | Derivado de MCR/WordNet en español. |

Los datos que enseña el usuario no se guardan aquí: se escriben en
`NUBEOS_DATA/conocimiento/` (`lexico-usuario.json`, `relaciones-usuario.json`,
`documentos-usuario.json` y `reglas-usuario.json`).

## Formato de un concepto

```json
{
  "id": "verde",
  "lema": "verde",
  "categoria": "adjetivo",
  "sinonimos": ["verdoso"],
  "acepciones": [
    {
      "definicion": "color de la vegetación",
      "genero": "color",
      "diferencia": "que recuerda al de las hojas y la hierba",
      "ejemplo": "El verde del bosque se intensifica en primavera.",
      "relaciones": [
        ["asociado_con", "vegetacion"],
        ["opuesto_a", "rojo"]
      ]
    }
  ]
}
```

- `genero` produce un hecho `es_un(concepto, genero)`.
- Cada relación produce un hecho `predicado(origen, destino)`.
- Los destinos se resuelven por `id`, por lema o por sinónimo; si no existen, se conserva un slug.
- Las reglas se aplican al cargar y las deducciones quedan disponibles con su traza.

## Reglas

El fichero `reglas.json` usa variables `?x`, `?y`, `?z`:

```json
{
  "nombre": "transitividad_es_un",
  "si": [["es_un", "?x", "?y"], ["es_un", "?y", "?z"]],
  "entonces": [["es_un", "?x", "?z"]]
}
```

Reglas incluidas:

- `transitividad_es_un`: si A es un B y B es un C, A es un C.
- `simetria_sinonimo`: la sinonimia se recorre en ambos sentidos.
- `herencia_sinonimo`: los sinónimos comparten género.
- `simetria_asociado_con`: la asociación conceptual es simétrica.
- `transitividad_parte_de`: si A es parte de B y B es parte de C, A es parte de C.

## Consultar y enseñar

En el modo **Lógica** de Agentic, el botón **+ Enseñar concepto** abre un formulario para guardar
un lema, una definición, un género y relaciones (`parte_de: tecnología, asociado_con: energía`).
Para relaciones, textos y reglas, o para automatizar altas, se usa la API local. La API exige la
cabecera `x-nubeos: 1`.

```bash
curl -s http://127.0.0.1:4310/api/conocimiento/status -H 'x-nubeos: 1'
curl -s http://127.0.0.1:4310/api/conocimiento/consultar \
  -H 'x-nubeos: 1' -H 'content-type: application/json' \
  -d '{"texto":"¿Qué es el verde?"}'
```

Enseñar un concepto:

```bash
curl -s http://127.0.0.1:4310/api/conocimiento/ensenar \
  -H 'x-nubeos: 1' -H 'content-type: application/json' \
  -d '{"tipo":"concepto","lema":"fotosíntesis artificial","definicion":"proceso técnico que imita la fotosíntesis natural","genero":"proceso","relaciones":[["parte_de","tecnología"]]}'
```

Enseñar una relación usa `predicado`. No se debe reutilizar `tipo` para el predicado porque `tipo`
indica la operación (`concepto`, `relacion`, `texto` o `regla`):

```json
{
  "tipo": "relacion",
  "origen": "fotosíntesis artificial",
  "predicado": "parte_de",
  "destino": "tecnología"
}
```

Enseñar un texto recuperable:

```json
{
  "tipo": "texto",
  "titulo": "Notas sobre el huerto",
  "fuente": "Apuntes propios",
  "texto": "El huerto necesita riego, luz y tierra fértil."
}
```

## Diccionario abierto MCR

- **Fuente**: <https://github.com/omwn/omw-data/blob/main/wns/mcr/wn-data-spa.tab>
- **Proyecto**: Multilingual Central Repository (MCR) 2.0 / Open Multilingual WordNet.
- **Licencia**: Creative Commons Attribution 3.0 (CC BY 3.0),
  <https://creativecommons.org/licenses/by/3.0/>.
- **Atribución**: datos derivados de MCR/OMW, WordNet en español.

Transformaciones aplicadas por `scripts/importar-mcr.mjs`:

1. Se agrupan las líneas por synset.
2. Se conservan los lemas, la categoría gramatical, la primera definición y hasta dos ejemplos.
3. Se recortan definiciones y ejemplos largos a 600 caracteres.
4. Se descartan synsets sin definición o sin lema.
5. Se guarda un JSON compacto con la fecha de generación y la atribución.

Para regenerarlo:

```bash
cd web-desktop
node scripts/importar-mcr.mjs
```

El script necesita conexión a internet solo en ese momento. El motor funciona después sin conexión.

## Privacidad y límites

- El motor no consulta internet; la búsqueda es local sobre los datos cargados.
- No inventa definiciones: si no hay datos, responde que no lo sabe y ofrece enseñarle el concepto.
- Los correos, planes y textos son plantillas deterministas. Los huecos se marcan con `[...]`.
- Las respuestas incluyen conceptos, fuentes y avisos para que el usuario pueda comprobarlas.
