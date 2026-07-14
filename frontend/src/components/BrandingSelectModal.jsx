import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Palette, CheckCircle, Plus, X, FileText, FileDown } from 'lucide-react';
import { getProfiles, refreshProfiles } from '../utils/brandingStorage';

/**
 * Modal shown before PDF/Word download.
 * Props:
 *   open       – boolean
 *   onClose    – () => void
 *   onSelect   – (profile | null, format) => void   // null = no branding
 *   format     – 'pdf' | 'word'
 */
export default function BrandingSelectModal({ open, onClose, onSelect, format = 'pdf' }) {
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState([]);
  const [selected, setSelected] = useState(null); // profile id or 'none'

  useEffect(() => {
    if (open) {
      const all = getProfiles();
      setProfiles(all);
      const def = all.find(p => p.isDefault);
      setSelected(def ? def.id : 'none');
      refreshProfiles().then((fresh) => {
        setProfiles(fresh);
        setSelected((prev) => (prev !== 'none' && fresh.some(p => p.id === prev))
          ? prev
          : (fresh.find(p => p.isDefault)?.id ?? 'none'));
      });
    }
  }, [open]);

  if (!open) return null;

  const formatLabel = format === 'pdf' ? 'PDF' : 'Word';
  const FormatIcon = format === 'pdf' ? FileDown : FileText;

  const handleDownload = () => {
    const profile = selected === 'none' ? null : profiles.find(p => p.id === selected) || null;
    onSelect(profile, format);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-teal-50 rounded-lg">
              <Palette className="w-5 h-5 text-teal-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Choose Branding</h2>
              <p className="text-xs text-gray-500 mt-0.5">Select a letterhead profile for your {formatLabel}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Options */}
        <div className="px-6 py-4 space-y-2 max-h-72 overflow-y-auto">
          {/* No branding option */}
          <label className="flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors hover:bg-gray-50"
            style={{ borderColor: selected === 'none' ? '#21C1B6' : '#e5e7eb', background: selected === 'none' ? '#f0fdfa' : '' }}>
            <input type="radio" className="hidden" checked={selected === 'none'} onChange={() => setSelected('none')} />
            <div className="w-8 h-8 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center flex-shrink-0">
              <FormatIcon className="w-4 h-4 text-gray-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-800">No Branding</div>
              <div className="text-xs text-gray-500">Standard JuriNex header</div>
            </div>
            {selected === 'none' && <CheckCircle className="w-4 h-4 text-teal-600 flex-shrink-0" />}
          </label>

          {/* Profile options */}
          {profiles.map(profile => (
            <label key={profile.id}
              className="flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors hover:bg-gray-50"
              style={{ borderColor: selected === profile.id ? '#21C1B6' : '#e5e7eb', background: selected === profile.id ? '#f0fdfa' : '' }}>
              <input type="radio" className="hidden" checked={selected === profile.id} onChange={() => setSelected(profile.id)} />
              {profile.logo ? (
                <img src={profile.logo} alt="" className="w-8 h-8 object-contain rounded border border-gray-200 flex-shrink-0" />
              ) : (
                <div className="w-8 h-8 rounded-lg border border-gray-200 bg-teal-50 flex items-center justify-center flex-shrink-0">
                  <Palette className="w-4 h-4 text-teal-400" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-gray-800 truncate">{profile.name || '(Unnamed)'}</span>
                  {profile.isDefault && (
                    <span className="text-xs bg-teal-50 text-teal-600 px-1.5 py-0.5 rounded-full font-medium flex-shrink-0">Default</span>
                  )}
                </div>
                <div className="text-xs text-gray-500 truncate">{profile.firmName || 'No firm name'}</div>
              </div>
              {selected === profile.id && <CheckCircle className="w-4 h-4 text-teal-600 flex-shrink-0" />}
            </label>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 pt-3 border-t border-gray-100">
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => navigate('/branding')}
              className="flex items-center gap-1.5 text-xs text-teal-600 hover:text-teal-700 font-medium cursor-pointer transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Manage profiles
            </button>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors cursor-pointer">
                Cancel
              </button>
              <button
                onClick={handleDownload}
                className="px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <FormatIcon className="w-4 h-4" />
                Download {formatLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
