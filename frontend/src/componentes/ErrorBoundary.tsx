import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Red de seguridad para errores de render que React no puede recuperar solo
 * (p.ej. "NotFoundError: Failed to execute 'removeChild' on 'Node'" cuando
 * una extensión del navegador —el traductor de Chrome, Grammarly— reescribe
 * nodos de texto que React todavía controla). Sin esto, ese tipo de error
 * deja la pantalla en blanco sin ninguna pista de qué pasó ni cómo seguir.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Error no capturado en la interfaz:", error, info.componentStack);
  }

  private reintentar = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <div className="tarjeta" style={{ margin: 24, maxWidth: 640 }}>
        <h1>Ocurrió un error inesperado</h1>
        <p className="texto-tenue">
          La interfaz encontró un error y no pudo continuar. Si acabas de contabilizar algo,
          revisa "Partidas abiertas" antes de reintentar — es posible que sí se haya
          registrado. Esto puede pasar por extensiones del navegador (por ejemplo, el
          traductor de Chrome) que modifican la página mientras React la actualiza.
        </p>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            fontSize: 12.5,
            background: "var(--fondo)",
            padding: 12,
            borderRadius: 6,
            border: "1px solid var(--borde)",
          }}
        >
          {error.message}
        </pre>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button type="button" className="primario" onClick={this.reintentar}>
            Reintentar sin recargar
          </button>
          <button type="button" className="secundario" onClick={() => window.location.reload()}>
            Recargar la página
          </button>
        </div>
      </div>
    );
  }
}
