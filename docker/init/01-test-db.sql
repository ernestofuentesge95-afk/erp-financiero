-- Solo corre la primera vez que se crea el volumen de datos (imagen postgres
-- ejecuta todo lo que hay en /docker-entrypoint-initdb.d una única vez).
-- Provee una base de datos separada para la suite de tests, aislada de la de
-- desarrollo (erp_financiero).
CREATE DATABASE erp_financiero_test;
