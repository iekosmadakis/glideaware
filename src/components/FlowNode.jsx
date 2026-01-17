/**
 * @fileoverview Custom Flow Node Component for React Flow
 * @description Renders styled nodes for the code visualization flowchart
 * with support for different node types and click-to-code functionality.
 */

import { memo } from 'react';
import { Handle, Position } from 'reactflow';

/**
 * Custom node component for the flow diagram
 * @param {Object} props - Node properties from React Flow
 */
function FlowNode({ data, selected }) {
  const { label, nodeType, style, subtype } = data;
  const isCondition = style?.shape === 'diamond';
  const isTerminator = ['return', 'throw', 'break', 'continue'].includes(nodeType);

  return (
    <div
      className={`flow-node flow-node-${nodeType} ${selected ? 'selected' : ''} ${isCondition ? 'diamond' : ''}`}
      style={{
        background: style?.background || '#374151',
        borderColor: selected ? '#00d4aa' : (style?.borderColor || '#374151'),
        color: style?.color || '#ffffff'
      }}
      title={data.fullLabel || label}
    >
      {/* Input handle (top) */}
      <Handle
        type="target"
        position={Position.Top}
        className="flow-handle"
        style={{ background: style?.borderColor || '#4a4a6a' }}
      />

      {/* Node content */}
      <div className="flow-node-content">
        <span className="flow-node-label">{label}</span>
        {subtype && (
          <span className="flow-node-subtype">{subtype}</span>
        )}
      </div>

      {/* Output handle (bottom) - not for terminators */}
      {!isTerminator && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="flow-handle"
          style={{ background: style?.borderColor || '#4a4a6a' }}
        />
      )}

      {/* Side handles for conditions */}
      {isCondition && (
        <>
          <Handle
            type="source"
            position={Position.Left}
            id="false"
            className="flow-handle flow-handle-false"
            style={{ background: '#ef4444' }}
          />
          <Handle
            type="source"
            position={Position.Right}
            id="true"
            className="flow-handle flow-handle-true"
            style={{ background: '#22c55e' }}
          />
        </>
      )}
    </div>
  );
}

export default memo(FlowNode);
