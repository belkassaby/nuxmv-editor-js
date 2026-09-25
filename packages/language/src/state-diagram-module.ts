import {
    createDefaultCoreModule,
    createDefaultSharedCoreModule,
    DefaultScopeComputation,
    inject,
    type AstNode,
    type AstNodeDescription,
    type DefaultSharedCoreModuleContext,
    type LangiumCoreServices,
    type LangiumDocument,
    type LangiumSharedCoreServices,
    type Module,
    type MultiMap,
    type PartialLangiumCoreServices
} from 'langium';
import { isAttribute, isDiagram, isVariable } from './generated/ast.js';
import { StateDiagramGeneratedModule, StateDiagramGeneratedSharedModule } from './generated/module.js';
import { StateDiagramValidator, registerValidationChecks } from './state-diagram-validator.js';

export type StateDiagramAddedServices = {
    validation: {
        StateDiagramValidator: StateDiagramValidator;
    };
};

export type StateDiagramServices = LangiumCoreServices & StateDiagramAddedServices;

/**
 * Attributes and variables are declared inside blocks but are referenced from
 * state assignments and transition updates, so make them visible document-wide.
 */
export class StateDiagramScopeComputation extends DefaultScopeComputation {
    protected override addLocalSymbol(node: AstNode, document: LangiumDocument, symbols: MultiMap<AstNode, AstNodeDescription>): void {
        if (isAttribute(node) || isVariable(node)) {
            const root = document.parseResult.value;
            if (isDiagram(root) && node.name) {
                symbols.add(root, this.descriptions.createDescription(node, node.name, document));
            }
            return;
        }
        super.addLocalSymbol(node, document, symbols);
    }
}

export const StateDiagramModule: Module<StateDiagramServices, PartialLangiumCoreServices & StateDiagramAddedServices> = {
    references: {
        ScopeComputation: services => new StateDiagramScopeComputation(services)
    },
    validation: {
        StateDiagramValidator: () => new StateDiagramValidator()
    }
};

export function createStateDiagramServices(context: DefaultSharedCoreModuleContext): {
    shared: LangiumSharedCoreServices;
    StateDiagram: StateDiagramServices;
} {
    const shared = inject(createDefaultSharedCoreModule(context), StateDiagramGeneratedSharedModule);
    const StateDiagram = inject(createDefaultCoreModule({ shared }), StateDiagramGeneratedModule, StateDiagramModule);
    shared.ServiceRegistry.register(StateDiagram);
    registerValidationChecks(StateDiagram);
    return { shared, StateDiagram };
}
