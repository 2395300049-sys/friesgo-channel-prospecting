import React from 'react';
import {createRoot} from 'react-dom/client';
import Workbench from '../app/workbench';
import '../app/globals.css';
createRoot(document.getElementById('root')!).render(<Workbench displayName="本地工作台" localMode/>);
