import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Senza questo, i container di render() restano nel document.body tra un
// test e l'altro: id duplicati (#dVinJobs ecc.) fanno inciampare il fast
// path per selettori-id di jsdom/nwsapi su query composte tipo
// "#dVinJobs > div", che risolvono sul primo nodo nel documento invece che
// dentro il container corrente.
afterEach(cleanup);
