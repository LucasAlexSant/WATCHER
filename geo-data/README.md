# Catálogo territorial

`municipalities.json` usa os campos `[código, nome, UF, latitude, longitude]` de duas fontes públicas do IBGE consultadas em 20 de novembro de 2026.

- A API de Localidades fornece os códigos, nomes e UFs. [Municípios](https://servicodados.ibge.gov.br/api/v1/localidades/municipios)
- O GeoPackage do Censo 2022 fornece coordenadas de referência de sedes, capitais e Fernando de Noronha. [Localidades do Brasil](https://geoftp.ibge.gov.br/organizacao_do_territorio/estrutura_territorial/localidades/Localidades_do_Brasil/2022/)

A junção usa o código do município e arredonda as coordenadas a seis casas decimais. Os pontos representam sedes e servem para sugestões aproximadas. A confirmação do local da ocorrência ocorre no relato.
