/**
 * Note: this file should import all other files for type discovery and declaration merging
 */
import { buildThunks, PatchQueryResultThunk, UpdateQueryResultThunk } from './buildThunks';
import { AnyAction, Middleware, Reducer, ThunkDispatch } from '@reduxjs/toolkit';
import { PrefetchOptions } from '../redux-hooks/buildHooks';
import {
  EndpointDefinitions,
  QueryArgFrom,
  QueryDefinition,
  MutationDefinition,
  AssertEntityTypes,
  isQueryDefinition,
  isMutationDefinition,
} from '../endpointDefinitions';
import { CombinedState, QueryKeys, RootState } from './apiState';
import './buildSelectors';
import { Api, Module } from '../apiTypes';
import { onFocus, onFocusLost, onOnline, onOffline } from '../setupListeners';
import { buildSlice } from './buildSlice';
import { buildMiddleware } from './buildMiddleware';
import { buildSelectors } from './buildSelectors';
import { buildActionMaps } from './buildActionMaps';
import { assertCast, safeAssign } from '../tsHelpers';
import { IS_DEV } from '../utils';
import { InternalSerializeQueryArgs } from '../defaultSerializeQueryArgs';

const coreModuleName = Symbol();
export type CoreModule = typeof coreModuleName;

declare module '../apiTypes' {
  export interface ApiModules<
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    BaseQuery extends BaseQueryFn,
    Definitions extends EndpointDefinitions,
    ReducerPath extends string,
    EntityTypes extends string
  > {
    [coreModuleName]: {
      reducerPath: ReducerPath;
      internalActions: InternalActions;
      reducer: Reducer<CombinedState<Definitions, EntityTypes, ReducerPath>, AnyAction>;
      middleware: Middleware<{}, RootState<Definitions, string, ReducerPath>, ThunkDispatch<any, any, AnyAction>>;
      util: {
        updateQueryResult: UpdateQueryResultThunk<Definitions, RootState<Definitions, string, ReducerPath>>;
        patchQueryResult: PatchQueryResultThunk<Definitions, RootState<Definitions, string, ReducerPath>>;
      };
      // If you actually care about the return value, use useQuery
      usePrefetch<EndpointName extends QueryKeys<Definitions>>(
        endpointName: EndpointName,
        options?: PrefetchOptions
      ): (arg: QueryArgFrom<Definitions[EndpointName]>, options?: PrefetchOptions) => void;
      endpoints: {
        [K in keyof Definitions]: Definitions[K] extends QueryDefinition<any, any, any, any, any>
          ? ApiEndpointQuery<Definitions[K], Definitions>
          : Definitions[K] extends MutationDefinition<any, any, any, any, any>
          ? ApiEndpointMutation<Definitions[K], Definitions>
          : never;
      };
    };
  }
}

export interface ApiEndpointQuery<
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  Definition extends QueryDefinition<any, any, any, any, any>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  Definitions extends EndpointDefinitions
> {}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface ApiEndpointMutation<
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  Definition extends MutationDefinition<any, any, any, any, any>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  Definitions extends EndpointDefinitions
> {}

export const coreModule: Module<CoreModule> = (
  api,
  {
    baseQuery,
    entityTypes,
    reducerPath,
    serializeQueryArgs,
    keepUnusedDataFor,
    refetchOnMountOrArgChange,
    refetchOnFocus,
    refetchOnReconnect,
  },
  { endpointDefinitions }
) => {
  assertCast<InternalSerializeQueryArgs<any>>(serializeQueryArgs);

  const assertEntityType: AssertEntityTypes = (entity) => {
    if (IS_DEV()) {
      if (!entityTypes.includes(entity.type as any)) {
        console.error(`Entity type '${entity.type}' was used, but not specified in \`entityTypes\`!`);
      }
    }
    return entity;
  };

  const uninitialized: any = () => {
    throw Error('called before initialization');
  };
  Object.assign(api, {
    reducerPath,
    endpoints: {},
    internalActions: {
      removeQueryResult: uninitialized,
      unsubscribeMutationResult: uninitialized,
      unsubscribeQueryResult: uninitialized,
      updateSubscriptionOptions: uninitialized,
      queryResultPatched: uninitialized,
      prefetchThunk: uninitialized,
      onOnline,
      onOffline,
      onFocus,
      onFocusLost,
    },
    util: {
      patchQueryResult: uninitialized,
      updateQueryResult: uninitialized,
    },
    usePrefetch: () => () => {},
    reducer: uninitialized,
    middleware: uninitialized,
  });

  const {
    queryThunk,
    mutationThunk,
    patchQueryResult,
    updateQueryResult,
    prefetchThunk,
    buildMatchThunkActions,
  } = buildThunks({
    baseQuery,
    reducerPath,
    endpointDefinitions,
    api,
    serializeQueryArgs,
  });

  const { reducer, actions: sliceActions } = buildSlice({
    endpointDefinitions,
    queryThunk,
    mutationThunk,
    reducerPath,
    assertEntityType,
    config: { refetchOnFocus, refetchOnReconnect, refetchOnMountOrArgChange, keepUnusedDataFor, reducerPath },
  });

  const { middleware } = buildMiddleware({
    reducerPath,
    endpointDefinitions,
    queryThunk,
    mutationThunk,
    api,
    assertEntityType,
  });

  safeAssign(api.util, { patchQueryResult, updateQueryResult });
  safeAssign(api.internalActions, sliceActions, { prefetchThunk: prefetchThunk as any });
  safeAssign(api, { reducer: reducer as any, middleware });

  const { buildQuerySelector, buildMutationSelector } = buildSelectors({
    serializeQueryArgs,
    reducerPath,
  });

  const { buildQueryAction, buildMutationAction } = buildActionMaps({
    queryThunk,
    mutationThunk,
    api,
    serializeQueryArgs,
  });

  return {
    name: coreModuleName,
    injectEndpoint(endpoint, definition) {
      const anyApi = (api as any) as Api<any, Record<string, any>, string, string, CoreModule>;
      if (isQueryDefinition(definition)) {
        safeAssign(
          anyApi.endpoints[endpoint],
          {
            select: buildQuerySelector(endpoint, definition),
            initiate: buildQueryAction(endpoint, definition),
          },
          buildMatchThunkActions(queryThunk, endpoint)
        );
      } else if (isMutationDefinition(definition)) {
        safeAssign(
          anyApi.endpoints[endpoint],
          {
            select: buildMutationSelector(),
            initiate: buildMutationAction(endpoint, definition),
          },
          buildMatchThunkActions(mutationThunk, endpoint)
        );
      }
    },
  };
};
