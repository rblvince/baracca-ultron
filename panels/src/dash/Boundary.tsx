import { Component, type ReactNode } from 'react';

/** Un pannello che lancia non spegne la dashboard né la scena: al suo posto
 *  resta la cornice con "pannello non disponibile". */
export class PanelBoundary extends Component<{ cls: string; title: string; children: ReactNode }, { broken: boolean }> {
  state = { broken: false };
  static getDerivedStateFromError() { return { broken: true }; }
  render() {
    if (!this.state.broken) return this.props.children;
    return (
      <div className={this.props.cls}>
        <h4>{this.props.title} <span className="dtag err">ERRORE</span></h4>
        <div className="empty">pannello non disponibile</div>
      </div>
    );
  }
}
