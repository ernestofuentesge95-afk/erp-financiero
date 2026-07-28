/**
 * Migración de ejemplo para validar el setup de node-pg-migrate.
 * Se elimina en Fase 1 al introducir las tablas reales del núcleo contable.
 */
exports.up = (pgm) => {
  pgm.createTable("_migracion_ejemplo", {
    id: "id",
    creado_en: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });
};

exports.down = (pgm) => {
  pgm.dropTable("_migracion_ejemplo");
};
