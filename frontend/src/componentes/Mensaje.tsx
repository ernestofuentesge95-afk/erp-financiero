export function MensajeError({ texto }: { texto: string }): React.JSX.Element {
  return <div className="mensaje mensaje-error">{texto}</div>;
}

export function MensajeExito({ texto }: { texto: string }): React.JSX.Element {
  return <div className="mensaje mensaje-exito">{texto}</div>;
}
