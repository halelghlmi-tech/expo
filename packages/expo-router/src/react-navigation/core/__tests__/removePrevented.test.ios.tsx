import { act, render } from '@testing-library/react-native';
import * as React from 'react';

import { CommonActions, type ParamListBase, StackActions, StackRouter } from '../../routers';
import { Screen } from '../Screen';
import { createNavigationContainerRef } from '../createNavigationContainerRef';
import { useNavigationBuilder } from '../useNavigationBuilder';
import { usePreventRemove } from '../usePreventRemove';
import { BaseNavigationContainer } from './__fixtures__/BaseNavigationContainer';

jest.mock('nanoid/non-secure', () => {
  const m = { nanoid: () => String(++m.__key), __key: 0 };
  return m;
});

beforeEach(() => {
  require('nanoid/non-secure').__key = 0;
});

test('blocks removal and emits removed with deferred effect cleanup', async () => {
  const TestNavigator = (props: any) => {
    const { state, descriptors, NavigationContent } = useNavigationBuilder(StackRouter, props);
    return (
      <NavigationContent>
        {state.routes.map((route) => descriptors[route.key]!.render())}
      </NavigationContent>
    );
  };
  const removePrevented = jest.fn();
  const removed = jest.fn();
  const explicitlyUnsubscribedRemoved = jest.fn();
  let setPreventRemove: React.Dispatch<React.SetStateAction<boolean>>;
  let unsubscribeRemoved: () => void;

  const TestScreen = ({ navigation }: any) => {
    const [preventRemove, setPreventRemoveState] = React.useState(true);
    setPreventRemove = setPreventRemoveState;
    usePreventRemove(preventRemove, removePrevented);
    React.useEffect(() => navigation.addListener('removePrevented', removePrevented), [navigation]);
    React.useEffect(() => {
      const unsubscribe = navigation.addListener('removed', removed);
      return () => queueMicrotask(unsubscribe);
    }, [navigation]);
    React.useEffect(() => {
      unsubscribeRemoved = navigation.addListener('removed', explicitlyUnsubscribedRemoved);
      return () => queueMicrotask(unsubscribeRemoved);
    }, [navigation]);
    return null;
  };

  const ref = createNavigationContainerRef<ParamListBase>();
  await render(
    <BaseNavigationContainer ref={ref}>
      <TestNavigator initialRouteName="foo">
        <Screen name="foo">{() => null}</Screen>
        <Screen name="bar" component={TestScreen} />
      </TestNavigator>
    </BaseNavigationContainer>
  );

  await act(() => ref.current?.navigate('bar'));
  const action = StackActions.pop();
  await act(() => ref.current?.dispatch(action));

  expect(ref.current?.getRootState().routes.map((route) => route.name)).toEqual(['foo', 'bar']);
  expect(removePrevented).toHaveBeenCalledTimes(2);
  expect(removePrevented.mock.calls[0][0].data.action).toBe(action);
  expect(removePrevented.mock.calls[1][0].data.action).toBe(action);
  expect(removed).not.toHaveBeenCalled();

  await act(() => unsubscribeRemoved());
  await act(() => setPreventRemove(false));
  await act(() => ref.current?.dispatchSync(CommonActions.goBack()));

  expect(ref.current?.getRootState().routes.map((route) => route.name)).toEqual(['foo']);
  expect(removed).toHaveBeenCalledTimes(1);
  expect(explicitlyUnsubscribedRemoved).not.toHaveBeenCalled();
});

// TODO(@ubax): prevent synchronous redispatch from a `removePrevented` callback.
test.skip('blocks synchronous redispatch from removePrevented without re-emitting', async () => {
  const TestNavigator = (props: any) => {
    const { state, descriptors, NavigationContent } = useNavigationBuilder(StackRouter, props);
    return (
      <NavigationContent>
        {state.routes.map((route) => descriptors[route.key]!.render())}
      </NavigationContent>
    );
  };
  const ref = createNavigationContainerRef<ParamListBase>();
  const removePrevented = jest.fn(({ data }) => ref.current?.dispatchSync(data.action));

  const TestScreen = () => {
    usePreventRemove(true, removePrevented);
    return null;
  };

  await render(
    <BaseNavigationContainer ref={ref}>
      <TestNavigator initialRouteName="foo">
        <Screen name="foo">{() => null}</Screen>
        <Screen name="bar" component={TestScreen} />
      </TestNavigator>
    </BaseNavigationContainer>
  );

  await act(() => ref.current?.navigate('bar'));
  await act(() => ref.current?.dispatchSync(CommonActions.goBack()));

  expect(ref.current?.getRootState().routes.map((route) => route.name)).toEqual(['foo', 'bar']);
  expect(removePrevented).toHaveBeenCalledTimes(1);
});

// TODO(@hassankhan): Re-enable once a nested `removed` event survives a microtask boundary.
// The screen unsubscribes its `removed` listener in a microtask after it unmounts. On the legacy
// react-test-renderer root, `act` ran the parent removal, that unmount, and the delivery of the
// `removed-routes` report in one synchronous pass, so the microtask only ran after the event had
// arrived. test-renderer uses a concurrent root: the parent removal commits first and the report
// is delivered in a later commit. The microtask runs in between, so the listener is already gone
// when `removed` reaches the nested navigator. The registry still holds the route's emitter; only
// the screen's listener is missing.
test.skip('emits removed in a nested navigator when its parent route is removed', async () => {
  const TestNavigator = (props: any) => {
    const { state, descriptors, NavigationContent } = useNavigationBuilder(StackRouter, props);
    return (
      <NavigationContent>
        {state.routes.map((route) => descriptors[route.key]!.render())}
      </NavigationContent>
    );
  };
  const removed = jest.fn();

  const NestedScreen = ({ navigation }: any) => {
    React.useEffect(() => {
      const unsubscribe = navigation.addListener('removed', removed);
      return () => queueMicrotask(unsubscribe);
    }, [navigation]);
    return null;
  };

  const NestedNavigator = () => (
    <TestNavigator>
      <Screen name="nested" component={NestedScreen} />
    </TestNavigator>
  );

  const ref = createNavigationContainerRef<ParamListBase>();
  await render(
    <BaseNavigationContainer
      ref={ref}
      initialState={{
        type: 'stack',
        index: 0,
        routeNames: ['foo', 'bar'],
        routes: [
          { name: 'foo' },
          { name: 'bar', state: { type: 'stack', routes: [{ name: 'nested' }] } },
        ],
      }}>
      <TestNavigator initialRouteName="foo">
        <Screen name="foo">{() => null}</Screen>
        <Screen name="bar" component={NestedNavigator} />
      </TestNavigator>
    </BaseNavigationContainer>
  );

  await act(() => ref.current?.navigate('bar'));
  const action = CommonActions.goBack();
  await act(() => ref.current?.dispatch(action));

  expect(ref.current?.getRootState().routes.map((route) => route.name)).toEqual(['foo']);
  expect(removed).toHaveBeenCalledTimes(1);
  expect(removed.mock.calls[0][0].data.action).toBe(action);
});
