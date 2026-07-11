import React, { useMemo } from 'react';
import type { OcrPage } from '../../types/ocr';
import type { OcrConfidenceFilter } from '../../hooks/useOcrDocumentViewer';
import OcrWordBox from './OcrWord';

export interface OcrPageProps {
  page: OcrPage;
  zoom: number;
  confidenceFilter: OcrConfidenceFilter;
}

const OcrPageView: React.FC<OcrPageProps> = ({
  page,
  zoom,
  confidenceFilter,
}) => {
  const { width, height, words } = page;

  const wordBoxes = useMemo(
    () => {
      return words.map((word, idx) => {
        const { bbox } = word;
        
        const style: React.CSSProperties = {
          position: 'absolute',
          left: `${(bbox.x / width) * 100}%`,
          top: `${(bbox.y / height) * 100}%`,
          width: `${(bbox.w / width) * 100}%`,
          height: `${(bbox.h / height) * 100}%`,
          fontSize: `${Math.max(8, Math.min(14, (bbox.h / height) * 100))}px`,
          lineHeight: '1',
        };
        return (
          <OcrWordBox
            key={`${word.text}-${idx}-${bbox.x}-${bbox.y}`}
            word={word}
            confidenceFilter={confidenceFilter}
            style={style}
          />
        );
      });
    },
    [words, width, height, confidenceFilter, page.page],
  );

  return (
    <div className="w-full h-full flex items-stretch justify-center">
      <div
        className="relative w-full max-h-full bg-white border border-gray-200 rounded-md shadow-sm overflow-hidden"
        style={{
          aspectRatio: `${width} / ${height}`,
          transform: `scale(${zoom})`,
          transformOrigin: 'top left',
        }}
      >
        <div className="absolute inset-0 bg-white/90">{wordBoxes}</div>
      </div>
    </div>
  );
};

export default OcrPageView;

