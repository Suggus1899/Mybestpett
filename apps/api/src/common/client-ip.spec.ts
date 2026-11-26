import { clientIp } from './client-ip.js';

const SECRET = 'secreto-compartido-de-la-web-0123456789';

describe('clientIp', () => {
  it('usa req.ip si no hay cabeceras de la web', () => {
    expect(clientIp({ ip: '10.0.0.1', headers: {} }, SECRET)).toBe('10.0.0.1');
  });

  it('acepta la IP reenviada solo con el secreto correcto', () => {
    const headers = {
      'x-petbf-web-key': SECRET,
      'x-petbf-client-ip': '190.202.1.5',
    };
    expect(clientIp({ ip: '10.0.0.1', headers }, SECRET)).toBe('190.202.1.5');
  });

  it('ignora la cabecera con un secreto falso o sin secreto configurado', () => {
    const headers = {
      'x-petbf-web-key': 'otro',
      'x-petbf-client-ip': '1.2.3.4',
    };
    expect(clientIp({ ip: '10.0.0.1', headers }, SECRET)).toBe('10.0.0.1');
    const good = { 'x-petbf-web-key': SECRET, 'x-petbf-client-ip': '1.2.3.4' };
    expect(clientIp({ ip: '10.0.0.1', headers: good }, undefined)).toBe(
      '10.0.0.1',
    );
  });

  it('ignora valores que no son una IP', () => {
    for (const value of ['', 'localhost', '1.2.3.4, 5.6.7.8', '999.1.1.1']) {
      const headers = { 'x-petbf-web-key': SECRET, 'x-petbf-client-ip': value };
      expect(clientIp({ ip: '10.0.0.1', headers }, SECRET)).toBe('10.0.0.1');
    }
    const ipv6 = {
      'x-petbf-web-key': SECRET,
      'x-petbf-client-ip': '2001:db8::1',
    };
    expect(clientIp({ ip: '10.0.0.1', headers: ipv6 }, SECRET)).toBe(
      '2001:db8::1',
    );
  });
});
