const functionsRepository = require('../repositories/functions.repository');
const FunctionModel = require('../models/Function.model');

class FunctionsService {
  async listGrouped() {
    return this._group(await functionsRepository.findClubAssignableGrouped());
  }

  /** Catálogo completo, incluidas las funcionalidades exclusivas de plataforma
   * (is_club_assignable = 0) — a diferencia de listGrouped(), que las excluye porque
   * alimenta el selector de funcionalidades al crear/editar un rol de club. */
  async listAllGrouped() {
    return this._group(await functionsRepository.findAllGrouped());
  }

  _group(rows) {
    const functions = rows.map(FunctionModel.fromRow);
    const grouped = functions.reduce((acc, fn) => {
      acc[fn.category] = acc[fn.category] || [];
      acc[fn.category].push(fn);
      return acc;
    }, {});
    return { functions, grouped };
  }
}

module.exports = new FunctionsService();
