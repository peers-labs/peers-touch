/**
 * The kinetic review entry mounts the actual canonical frame.
 * No copied rail, composer, conversations or second shell.
 */
import { createRoot } from 'react-dom/client';
import { DesignDirections } from '../../../shared/ui-system/DesignDirections';
import './chat-rail-motion.css';

createRoot(document.getElementById('root')!).render(<DesignDirections assemblyStudy />);
