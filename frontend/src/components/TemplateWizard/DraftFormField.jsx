import React from 'react';

/**
 * Renders a single form field from template_fields schema.
 * field_type: text, number, email, phone, date, textarea, select, radio, checkbox, file
 */
const DraftFormField = ({ field, value, onChange, error }) => {
  const {
    field_id,
    field_name,
    field_label,
    field_type,
    is_required,
    placeholder,
    options,
    help_text,
  } = field;

  const id = `field-${field_id || field_name}`;
  /* Use only draft value so fresh templates show empty; no template default_value pre-fill */
  const val = value !== undefined && value !== null ? value : '';
  const opts = options && (Array.isArray(options) ? options : options.options || []);

  const inputBase =
    'block w-full rounded-lg border bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 transition-all duration-150 ' +
    'hover:border-gray-400 focus:border-[#21C1B6] focus:outline-none focus:ring-2 focus:ring-[#21C1B6]/25 focus:shadow-sm ' +
    (error ? 'border-red-400 hover:border-red-500 focus:border-red-500 focus:ring-red-500/25' : 'border-gray-300');

  const common = {
    id,
    name: field_name,
    value: typeof val === 'string' ? val : (val ?? ''),
    onChange: (e) => onChange(field_name, e.target.type === 'checkbox' ? e.target.checked : e.target.value),
    placeholder: placeholder || '',
    required: !!is_required,
    className: inputBase,
  };

  return (
    <div className="mb-6 last:mb-0">
      <label htmlFor={id} className="block text-sm font-semibold text-gray-800 mb-2">
        {field_label}
        {is_required && <span className="text-red-500 ml-0.5" aria-hidden>*</span>}
      </label>
      {field_type === 'textarea' && (
        <textarea
          {...common}
          rows={4}
          className={`${common.className} resize-y min-h-[96px]`}
        />
      )}
      {field_type === 'select' && (
        <select
          {...common}
          className={`${common.className} cursor-pointer`}
        >
          <option value="">Select...</option>
          {opts.map((opt) => (
            <option key={typeof opt === 'object' ? opt.value : opt} value={typeof opt === 'object' ? opt.value : opt}>
              {typeof opt === 'object' ? opt.label ?? opt.value : opt}
            </option>
          ))}
        </select>
      )}
      {field_type === 'radio' && (
        <div className="mt-2 space-y-2">
          {opts.map((opt) => {
            const v = typeof opt === 'object' ? opt.value : opt;
            const label = typeof opt === 'object' ? opt.label ?? opt.value : opt;
            return (
              <label key={v} className="inline-flex items-center mr-4 cursor-pointer">
                <input
                  type="radio"
                  name={field_name}
                  value={v}
                  checked={String(val) === String(v)}
                  onChange={(e) => onChange(field_name, e.target.value)}
                  className="h-4 w-4 rounded-full border-gray-300 text-[#21C1B6] focus:ring-2 focus:ring-[#21C1B6]/20"
                />
                <span className="ml-2 text-sm text-gray-700">{label}</span>
              </label>
            );
          })}
        </div>
      )}
      {field_type === 'checkbox' && (
        <input
          type="checkbox"
          id={id}
          name={field_name}
          checked={!!val}
          onChange={(e) => onChange(field_name, e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-[#21C1B6] focus:ring-2 focus:ring-[#21C1B6]/20"
        />
      )}
      {['text', 'number', 'email', 'phone', 'date'].includes(field_type) && (
        <input
          type={field_type === 'number' ? 'number' : field_type === 'date' ? 'date' : 'text'}
          {...common}
        />
      )}
      {field_type === 'file' && (
        <input
          type="file"
          id={id}
          name={field_name}
          onChange={(e) => onChange(field_name, e.target.files?.[0]?.name ?? '')}
          className={common.className}
        />
      )}
      {help_text && <p className="mt-1.5 text-xs text-gray-500">{help_text}</p>}
      {error && <p className="mt-1.5 text-xs font-semibold text-red-600">{error}</p>}
    </div>
  );
};

export default DraftFormField;
